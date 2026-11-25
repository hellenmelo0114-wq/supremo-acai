// Barramento de eventos em memória para atualizações em tempo real (Server-Sent Events).
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(1000);
module.exports = bus;
