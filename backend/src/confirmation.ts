import { EventEmitter } from 'events';
export const confirmationEmitter = new EventEmitter();

export function askConfirmation(
  sessionId: string,
  tool: string,
  details: string,
): Promise<boolean> {
  return new Promise(resolve => {
    confirmationEmitter.emit('confirmation_required', { sessionId, tool, details });

    const onDecision = (data: { sessionId: string; approved: boolean }) => {
      if (data.sessionId === sessionId) {
        confirmationEmitter.off('confirmation_decision', onDecision);
        resolve(data.approved);
      }
    };
    confirmationEmitter.on('confirmation_decision', onDecision);

    // Auto-deny after 60 seconds
    setTimeout(() => {
      confirmationEmitter.off('confirmation_decision', onDecision);
      resolve(false);
    }, 60_000);
  });
}