const states = {};

function getConversationState(jid) {
  if (!states[jid]) {
    states[jid] = { status: 'IDLE', data: {} };
  }
  return states[jid];
}

function updateConversationState(jid, update) {
  if (!states[jid]) {
    states[jid] = { status: 'IDLE', data: {} };
  }
  states[jid] = { ...states[jid], ...update };
  return states[jid];
}

module.exports = { getConversationState, updateConversationState };
