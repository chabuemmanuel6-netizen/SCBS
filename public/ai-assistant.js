(() => {
  'use strict';
  const launcher = document.getElementById('scbs-ai-launcher');
  const panel = document.getElementById('scbs-ai-panel');
  const closeButton = document.getElementById('scbs-ai-close');
  const form = document.getElementById('scbs-ai-form');
  const input = document.getElementById('scbs-ai-question');
  const messages = document.getElementById('scbs-ai-messages');
  const status = document.getElementById('scbs-ai-status');
  const sendButton = document.getElementById('scbs-ai-send');
  if (!launcher || !panel || !form || !input || !messages || !status || !sendButton) return;

  const history = [];
  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }
  function addMessage(role, text) {
    const node = document.createElement('div');
    node.className = `scbs-ai-msg ${role}`;
    node.textContent = text;
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
  }
  launcher.addEventListener('click', () => setOpen(panel.hidden));
  closeButton?.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (question.length < 2 || question.length > 1000) {
      status.textContent = 'Please enter a question between 2 and 1000 characters.';
      return;
    }
    addMessage('user', question);
    input.value = '';
    input.disabled = true;
    sendButton.disabled = true;
    status.textContent = 'SCBS AI is thinking…';
    try {
      const response = await fetch('/api/ai-assistant', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: history.slice(-8) })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success || typeof result.answer !== 'string') {
        throw new Error(result.error || 'The assistant is temporarily unavailable. Please try again later.');
      }
      addMessage('assistant', result.answer);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: result.answer });
      if (history.length > 8) history.splice(0, history.length - 8);
      status.textContent = 'Answers use SCBS published information when available.';
    } catch (error) {
      status.textContent = error.message || 'Could not reach SCBS AI. Please try again.';
    } finally {
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  });
})();
