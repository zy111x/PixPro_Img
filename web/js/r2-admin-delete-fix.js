function adminToken() {
  return (localStorage.getItem('pixpro-admin-token') || '').trim();
}

async function deleteKeys(keys) {
  const token = adminToken();
  if (!token) throw new Error('管理口令已失效，请重新登录');

  const response = await fetch('/api/delete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ keys }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || '删除失败');
  }
  return data;
}

function selectedKeys() {
  return [...document.querySelectorAll('.gallery-item.selected')]
    .map((item) => item.dataset.key)
    .filter(Boolean);
}

async function handleDelete(keys, message) {
  if (!keys.length) return;
  if (!window.confirm(message)) return;

  try {
    await deleteKeys(keys);
    window.location.reload();
  } catch (error) {
    window.alert(error?.message || '删除失败');
  }
}

document.addEventListener('click', (event) => {
  const single = event.target.closest('.delete-btn');
  if (single) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const key = single.dataset.key;
    void handleDelete(key ? [key] : [], '确定删除这张图片吗？此操作不可恢复。');
    return;
  }

  const batch = event.target.closest('#deleteSelected');
  if (batch) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const keys = selectedKeys();
    if (!keys.length) {
      window.alert('请先选择图片');
      return;
    }
    void handleDelete(keys, `确定删除选中的 ${keys.length} 张图片吗？此操作不可恢复。`);
  }
}, true);
