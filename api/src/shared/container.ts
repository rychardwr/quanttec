import { ChatService } from '../modules/chat/chatService';
import { InMemoryChatRepository } from '../modules/chat/inMemoryChatRepository';
import { ChatRepository } from '../modules/chat/ports';
import { SqlChatRepository } from '../modules/chat/sqlChatRepository';
import { FieldCipher } from '../modules/privacy/fieldCipher';
import { AppConfig, getConfig } from './config';

// Composition root: the only place that picks concrete implementations.
let chatService: ChatService | undefined;

export function getChatService(): ChatService {
  chatService ??= createChatService(getConfig());
  return chatService;
}

function createChatService(config: AppConfig): ChatService {
  return new ChatService({
    repository: createRepository(config),
    cipher: new FieldCipher(config.fieldEncryptionKey, config.fieldHashKey),
    scope: config.serviceScope,
    clock: () => new Date(),
  });
}

function createRepository(config: AppConfig): ChatRepository {
  return config.dataStore.kind === 'sql'
    ? new SqlChatRepository(config.dataStore.connectionString)
    : new InMemoryChatRepository();
}
