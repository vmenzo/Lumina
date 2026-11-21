document.addEventListener('DOMContentLoaded', async () => {
  const cfg = await chrome.storage.sync.get({
    serverUrl: '',
    apiToken: '',
    copyFormat: 'markdown',
  });
  document.getElementById('serverUrl').value = cfg.serverUrl;
  document.getElementById('apiToken').value = cfg.apiToken;
  document.getElementById('copyFormat').value = cfg.copyFormat;

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const serverUrl = document.getElementById('serverUrl').value.trim().replace(/\/+$/, '');
    const apiToken = document.getElementById('apiToken').value.trim();
    const copyFormat = document.getElementById('copyFormat').value;
    await chrome.storage.sync.set({ serverUrl, apiToken, copyFormat });
    const st = document.getElementById('status');
    st.textContent = '✓ 已保存，现在可在任意图片上右键转存';
    setTimeout(() => { st.textContent = ''; }, 2500);
  });
});
