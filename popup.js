const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

// Load saved token on open
chrome.storage.sync.get('gitlabToken', (data) => {
    if (data.gitlabToken) {
        tokenInput.value = data.gitlabToken;
    }
});

saveBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    chrome.storage.sync.set({ gitlabToken: token }, () => {
        statusEl.textContent = 'Saved!';
        setTimeout(() => (statusEl.textContent = ''), 2000);
    });
});