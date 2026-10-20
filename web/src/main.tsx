import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatPage } from './chat/ChatPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatPage />
  </StrictMode>,
);
