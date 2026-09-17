/*
 * session.js - 今この端末を「誰が」使っているか
 *
 *   事務所（ログイン中）… MT.session.user にアカウントが入る
 *   現場（QR）          … 読み取ったQRの現場の鍵を、この端末に控えておく
 *
 * QRの鍵は「その現場の点検などに使ってよい」という証明の元。
 * 鍵そのものはサーバーに送って照合するだけで、画面には表示しない。
 */
(function (global) {
  'use strict';

  var KEYS_STORAGE = 'maruten-field-keys';
  var listeners = [];

  var state = {
    user: null,          // { id, loginId, name, role, mustChange }
    checked: false       // サーバーに確認済みか
  };

  function readKeys() {
    try {
      var raw = localStorage.getItem(KEYS_STORAGE);
      var obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function writeKeys(obj) {
    try { localStorage.setItem(KEYS_STORAGE, JSON.stringify(obj)); } catch (e) { /* 保存できなくても続行 */ }
  }

  function notify() {
    listeners.forEach(function (cb) {
      try { cb(state); } catch (e) { if (global.console) console.error(e); }
    });
  }

  var S = {
    get user() { return state.user; },
    get checked() { return state.checked; },

    isAdmin: function () { return !!state.user && !state.user.mustChange; },
    isManager: function () { return !!state.user && state.user.role === 'admin'; },
    mode: function () { return state.user ? 'admin' : 'field'; },

    setUser: function (user) {
      state.user = user || null;
      state.checked = true;
      notify();
    },

    onChange: function (cb) { listeners.push(cb); },

    /* ---------------- QRの鍵 ---------------- */
    fieldKeys: function () { return readKeys(); },

    fieldSites: function () {
      var keys = readKeys();
      return Object.keys(keys).map(function (id) {
        var k = keys[id];
        return { id: id, name: k.name || '', depot: !!k.depot, addedAt: k.addedAt || '', invalid: !!k.invalid };
      }).sort(function (a, b) { return (b.addedAt || '').localeCompare(a.addedAt || ''); });
    },

    addFieldKey: function (siteId, key, name, depot) {
      var keys = readKeys();
      keys[siteId] = { key: key, name: name || (keys[siteId] && keys[siteId].name) || '', depot: !!depot, addedAt: new Date().toISOString() };
      writeKeys(keys);
      notify();
    },

    markFieldKeyInvalid: function (siteId) {
      var keys = readKeys();
      if (keys[siteId]) {
        keys[siteId].invalid = true;
        writeKeys(keys);
        notify();
      }
    },

    renameFieldSite: function (siteId, name) {
      var keys = readKeys();
      if (keys[siteId] && name && keys[siteId].name !== name) {
        keys[siteId].name = name;
        writeKeys(keys);
      }
    },

    removeFieldKey: function (siteId) {
      var keys = readKeys();
      delete keys[siteId];
      writeKeys(keys);
      notify();
    },

    hasFieldAccess: function (siteId) {
      if (S.isAdmin()) return true;
      var k = readKeys()[siteId];
      return !!k && !k.invalid;
    }
  };

  global.MT.session = S;
})(window);
