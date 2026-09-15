import browser from "webextension-polyfill";

const promptUser = (api: string, args: any) => {
  const url =
    api +
    ".html" +
    (Object.keys(args).length === 0
      ? ""
      : "?" + new URLSearchParams(args).toString());

  // How long to wait, after the request window closes, for an answer it posted
  // just before closing (Approve and Reject close the window themselves).
  const CLOSED_WINDOW_GRACE_MS = 1000;

  return new Promise((resolve) => {
    const bc_bg_popup = new BroadcastChannel("dingo_bg_popup_" + args.id);
    let windowId: number | undefined;
    let settled = false;

    // Every request gets exactly one response: the window's answer, or an error
    // if the user closes the window without answering.
    const settle = (response: any) => {
      if (settled) {
        return;
      }
      settled = true;
      bc_bg_popup.close();
      browser.windows.onRemoved.removeListener(onWindowRemoved);
      resolve(response);
    };
    const onWindowRemoved = (removedId: number) => {
      if (removedId === windowId) {
        setTimeout(
          () => settle({ error: "User closed the request window" }),
          CLOSED_WINDOW_GRACE_MS
        );
      }
    };

    bc_bg_popup.addEventListener("message", (msg: any) => settle(msg.data));
    browser.windows.onRemoved.addListener(onWindowRemoved);

    browser.windows
      .create({
        url: browser.runtime.getURL(url),
        type: "popup",
        height: 620,
        width: 580,
      })
      .then((win) => {
        windowId = win.id;
      })
      .catch(() => settle({ error: "Could not open the request window" }));
  });
};

browser.runtime.onMessage.addListener((msg: any, _sender: any) => {
  const { request, origin } = msg;
  if (request.action === "getActiveAccountAddress") {
    return new Promise((resolve) => {
      browser.storage.sync.get("activeAccount").then((active: any) => {
        if ("activeAccount" in active) {
          resolve({ result: active.activeAccount.address });
        } else {
          resolve({ error: "No account selected" });
        }
      });
    });
  } else if (request.action === "requestSign") {
    return promptUser("signData", {
      id: request.id, // Used to create unique broadcast channel.
      origin: origin,
      data: request.data.content,
    });
  } else if (request.action === "requestSignTransaction") {
    const { vins, vouts } = request.data;
    let flattenedVins = "";
    for (const vin of vins) {
      if (flattenedVins !== "") {
        flattenedVins += ",";
      }
      flattenedVins += vin.txid;
      flattenedVins += ",";
      flattenedVins += vin.vout;
    }
    let flattenedVouts = "";
    for (const k of Object.keys(vouts)) {
      if (flattenedVouts !== "") {
        flattenedVouts += ",";
      }
      flattenedVouts += k;
      flattenedVouts += ",";
      flattenedVouts += vouts[k];
    }
    return promptUser("signTransaction", {
      id: request.id, // Used to create unique broadcast channel.
      origin: origin,
      vins: flattenedVins,
      vouts: flattenedVouts,
    });
  } else {
    return Promise.resolve({ error: "Unknown request" });
  }
});
