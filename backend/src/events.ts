// src/events.ts
import { EventEmitter } from 'events';

class AmazanEventEmitter extends EventEmitter {}

export const agentEventEmitter = new AmazanEventEmitter();
agentEventEmitter.setMaxListeners(50);
