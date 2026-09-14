const path = require("path");
const { execSync } = require("child_process");
const webpack = require("webpack");
const FilemanagerPlugin = require("filemanager-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const WextManifestWebpackPlugin = require("wext-manifest-webpack-plugin");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

const viewsPath = path.join(__dirname, "views");
const sourcePath = path.join(__dirname, "source");
const destPath = path.join(__dirname, "extension");

const getExtensionFileType = (browser) => {
  if (browser === "opera") {
    return "crx";
  }

  if (browser === "firefox") {
    return "xpi";
  }

  return "zip";
};

// Webpack 5 no longer polyfills Node core modules. source/dingocoin.js relies on
// `crypto` and `Buffer`, so map them to browser implementations.
const nodePolyfills = {
  fallback: {
    buffer: require.resolve("buffer/"),
    crypto: path.join(__dirname, "polyfills", "crypto.js"),
    stream: require.resolve("stream-browserify"),
  },
  plugin: new webpack.ProvidePlugin({
    Buffer: ["buffer", "Buffer"],
    process: "process/browser",
  }),
};

// Public key for Chrome test builds (the private half was never kept). Chrome
// gives each unpacked extension directory a new ID, so without a fixed key every
// zip dropped onto chrome://extensions would install as a separate extension
// with empty storage. With it, a new test build replaces the previous one and
// keeps its accounts. Its ID (lkfemlihploppkbhippkdnindnbfkedn) differs from the
// Chrome Web Store release, so the two never share data. Release builds omit it.
const TEST_BUILD_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA236zarT8MVSsd5H+G5GEP0Dw+BOcaWL3frjCZ6VFGvL6Y+Wf/5kVQvk0rZVLayHC4zkNR1UY2dktc67U8JDEJYxiEWhhYaDfEdJOFSYL26mMhkBoyR9Fbe9oSNHEQ3KeTq1llkLCy1GMFKmdn0T5r5dPDie1CHC8xkzFlo11qpLPlYd0LbyuZO9xALDiQ1QDMFT934DelqOQ9dKzCm/tLnTsbCVINbq2K71uWh7+ONAbhydxtGrhQksk64TUgn6c3FgokteuM6WfmhE2T5h7c98z7UL5fDi5N9zl/7qwOJ5o3MM2gfVNUhOza4QMAl+qO0dsrV7d6DM8M7c/fT47XwIDAQAB";

// Marks the manifest of a test build: fixed ID, "(test build)" name and the commit.
class TestBuildManifestPlugin {
  apply(compiler) {
    const { RawSource } = compiler.webpack.sources;
    compiler.hooks.thisCompilation.tap("TestBuildManifestPlugin", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "TestBuildManifestPlugin",
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        () => {
          const asset = compilation.getAsset("manifest.json");
          const manifest = JSON.parse(asset.source.source().toString());
          manifest.key = TEST_BUILD_KEY;
          manifest.name = `${manifest.name} (test build)`;
          manifest.version_name = `${manifest.version} test ${buildCommit()}`;
          compilation.updateAsset(
            "manifest.json",
            new RawSource(JSON.stringify(manifest, null, 2))
          );
        }
      );
    });
  }
}

const buildCommit = () => {
  if (process.env.BUILD_SHA) {
    return process.env.BUILD_SHA.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "local";
  }
};

module.exports = (env = {}) => {
  const nodeEnv = process.env.NODE_ENV || "development";
  const targetBrowser = env.browser || process.env.TARGET_BROWSER;
  if (!targetBrowser) {
    throw new Error("Set the target browser with --env browser=<chrome|firefox>");
  }
  // wext-manifest-loader reads the vendor from the environment.
  process.env.TARGET_BROWSER = targetBrowser;
  const testBuild = Boolean(env.testBuild);
  if (testBuild && targetBrowser !== "chrome") {
    throw new Error("Test builds are only supported for Chrome");
  }

  const outputPath = path.join(destPath, testBuild ? `${targetBrowser}-test` : targetBrowser);
  const archivePath = `${outputPath}.${getExtensionFileType(targetBrowser)}`;

  return {
    devtool: false, // https://github.com/webpack/webpack/issues/1194#issuecomment-560382342

    stats: {
      all: false,
      builtAt: true,
      errors: true,
      hash: true,
    },

    mode: nodeEnv,

    entry: {
      manifest: path.join(sourcePath, "manifest.json"),
      background: path.join(sourcePath, "Background", "index.ts"),
      popup: path.join(sourcePath, "Popup", "index.tsx"),
      signData: path.join(sourcePath, "SignData", "index.tsx"),
      signTransaction: path.join(sourcePath, "SignTransaction", "index.tsx"),
      setup: path.join(sourcePath, "Setup", "index.tsx"),
    },

    output: {
      path: outputPath,
      filename: "js/[name].bundle.js",
      // Resolve asset URLs relative to the extension page (webpack 4 behaviour).
      publicPath: "",
      clean: true,
    },

    resolve: {
      extensions: [".ts", ".tsx", ".js", ".json", ".png"],
      fallback: nodePolyfills.fallback,
    },

    module: {
      rules: [
        {
          type: "javascript/auto", // prevent webpack handling json with its own loaders,
          test: /manifest\.json$/,
          use: {
            loader: "wext-manifest-loader",
            options: {
              usePackageJSONVersion: true, // set to false to not use package.json version for manifest
            },
          },
          exclude: /node_modules/,
        },
        {
          test: /\.(js|ts)x?$/,
          loader: "babel-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.(sa|sc|c)ss$/,
          use: [
            MiniCssExtractPlugin.loader, // It creates a CSS file per JS file which contains CSS
            {
              loader: "css-loader", // Takes the CSS files and returns the CSS with imports and url(...) for Webpack
              options: {
                sourceMap: true,
              },
            },
            {
              loader: "postcss-loader",
              options: {
                postcssOptions: {
                  plugins: ["autoprefixer"],
                },
              },
            },
            {
              loader: "sass-loader", // Takes the Sass/SCSS file and compiles to the CSS
              options: {
                sassOptions: {
                  // Bootstrap 5 is themed through @import; silence the deprecation
                  // noise from it until Bootstrap supports @use.
                  quietDeps: true,
                  silenceDeprecations: ["import"],
                },
              },
            },
          ],
        },
        {
          test: /\.(png|jpe?g|gif)$/i,
          type: "asset/resource",
        },
      ],
    },

    plugins: [
      // Plugin to not generate js bundle for manifest entry
      new WextManifestWebpackPlugin(),
      ...(testBuild ? [new TestBuildManifestPlugin()] : []),
      // Generate sourcemaps
      new webpack.SourceMapDevToolPlugin({ filename: false }),
      new ForkTsCheckerWebpackPlugin(),
      // environmental variables
      new webpack.EnvironmentPlugin(["TARGET_BROWSER"]),
      nodePolyfills.plugin,
      new HtmlWebpackPlugin({
        template: path.join(viewsPath, "popup.html"),
        inject: "body",
        chunks: ["popup"],
        hash: true,
        filename: "popup.html",
      }),
      new HtmlWebpackPlugin({
        template: path.join(viewsPath, "signData.html"),
        inject: "body",
        chunks: ["signData"],
        hash: true,
        filename: "signData.html",
      }),
      new HtmlWebpackPlugin({
        template: path.join(viewsPath, "signTransaction.html"),
        inject: "body",
        chunks: ["signTransaction"],
        hash: true,
        filename: "signTransaction.html",
      }),
      new HtmlWebpackPlugin({
        template: path.join(viewsPath, "setup.html"),
        inject: "body",
        chunks: ["setup"],
        hash: true,
        filename: "setup.html",
      }),
      // write css file(s) to build folder
      new MiniCssExtractPlugin({ filename: "css/[name].css" }),
      // copy static assets
      new CopyWebpackPlugin({
        patterns: [
          { from: "source/assets", to: "assets" },
          {
            from: "node_modules/webextension-polyfill/dist/browser-polyfill.js",
            to: "assets/js",
          },
        ],
      }),
      // pack the build into a browser-specific archive
      new FilemanagerPlugin({
        events: {
          onStart: {
            delete: [archivePath],
          },
          onEnd: {
            archive: [
              {
                format: "zip",
                source: outputPath,
                destination: archivePath,
                options: { zlib: { level: 6 } },
              },
            ],
          },
        },
      }),
    ],

    optimization: {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          parallel: true,
          terserOptions: {
            format: {
              comments: false,
            },
          },
          extractComments: false,
        }),
        new CssMinimizerPlugin({
          minimizerOptions: {
            preset: ["default", { discardComments: { removeAll: true } }],
          },
        }),
      ],
    },
  };
};
