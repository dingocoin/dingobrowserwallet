import ReactDOM from 'react-dom';

import Popup from './Popup';

if (new URLSearchParams(window.location.search).get('view') === 'full') {
  document.body.classList.add('full-page');
}

ReactDOM.render(<Popup />, document.getElementById('popup-root'));
