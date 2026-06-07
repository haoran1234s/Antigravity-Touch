/**
 * DOM selectors for the Antigravity agent side panel.
 */

export const SELECTORS = {
  chatInput:
    [
      // Antigravity <= old builds
      '#antigravity\\.agentSidePanelInputBox [contenteditable="true"][role="textbox"]',
      // Antigravity 2.x (current): the message editor is a combobox with
      // aria-label="Message input", not role="textbox".
      '#antigravity\\.agentSidePanelInputBox [contenteditable="true"][aria-label="Message input"]',
      '#antigravity\\.agentSidePanelInputBox [contenteditable="true"][role="combobox"]',
      // Last-resort fallback inside the stable input container.
      '#antigravity\\.agentSidePanelInputBox [contenteditable="true"]',
    ].join(', '),
  messageList: '#conversation > div:first-child .mx-auto.w-full',
  conversation: '#conversation',
  spinner: '.antigravity-agent-side-panel .animate-spin',
} as const;
