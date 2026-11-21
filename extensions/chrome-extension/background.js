chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'lumina-save-image',
    title: '一键转存到 Lumina 图床',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'lumina-save-image' || !info.srcUrl) return;

  const cfg = await chrome.storage.sync.get({
    serverUrl: '',
    apiToken: '',
    copyFormat: 'markdown',
  });

  const base = (cfg.serverUrl || '').replace(/\/+$/, '');
  if (!base || !cfg.apiToken) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Lumina 光匣未配置',
      message: '请先点击浏览器右上角 Lumina 图标填写图床地址与 API Token。',
    });
    return;
  }

  try {
    const res = await fetch(`${base}/api/v1/upload/remote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': cfg.apiToken,
      },
      body: JSON.stringify({
        url: info.srcUrl,
        engine: 'smart',
        visibility: 'public',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.asset) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const asset = data.asset;
    const textToCopy =
      cfg.copyFormat === 'direct'
        ? asset.direct_url
        : cfg.copyFormat === 'html'
        ? `<img src="${asset.direct_url}" alt="${asset.original_name}" />`
        : `![${asset.original_name}](${asset.direct_url})`;

    if (tab && tab.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (txt) => navigator.clipboard.writeText(txt).catch(() => {}),
        args: [textToCopy],
      });
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: data.instant ? '⚡ 秒传成功 · 已复制外链' : '转存成功 · 已复制外链',
      message: asset.direct_url,
    });
  } catch (err) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Lumina 转存失败',
      message: err.message || '请检查图床地址与 Token 配置',
    });
  }
});
