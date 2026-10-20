import { app } from '@azure/functions';
import { getOptions, listMessages, postMessage, startConversation } from '../modules/chat/chatController';
import { getChatService } from '../shared/container';

app.http('chatOptions', {
  methods: ['GET'],
  route: 'v1/chat/options',
  authLevel: 'anonymous',
  handler: () => getOptions(getChatService()),
});

app.http('chatStartConversation', {
  methods: ['POST'],
  route: 'v1/chat/conversations',
  authLevel: 'anonymous',
  handler: (request) => startConversation(request, getChatService()),
});

app.http('chatListMessages', {
  methods: ['GET'],
  route: 'v1/chat/tickets/{ticketId}/messages',
  authLevel: 'anonymous',
  handler: (request) => listMessages(request, getChatService()),
});

app.http('chatPostMessage', {
  methods: ['POST'],
  route: 'v1/chat/tickets/{ticketId}/messages',
  authLevel: 'anonymous',
  handler: (request) => postMessage(request, getChatService()),
});
