import { useEffect, useState } from 'react';
import {
  init,
  retrieveRawInitData,
} from '@telegram-apps/sdk';

function App() {
  const [telegramConnected, setTelegramConnected] = useState(false);

  useEffect(() => {
    try {
      init();

      const initData = retrieveRawInitData();

      console.log('Telegram initData:', initData);

      if (initData) {
        setTelegramConnected(true);
      }
    } catch (error) {
      console.error('Telegram error:', error);
    }
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0b0b0b',
        color: '#ffffff',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '20px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '60px' }}>🔪</div>

        <h1>REAL MAFIA</h1>

        <p style={{ color: '#999' }}>
          Telegram Mafia Game
        </p>

        <div
          style={{
            marginTop: '30px',
            padding: '15px',
            borderRadius: '12px',
            background: '#171717',
          }}
        >
          {telegramConnected
            ? '🟢 Telegram ulandi'
            : '🔴 Telegram ulanmagan'}
        </div>

        <button
          style={{
            width: '100%',
            marginTop: '20px',
            padding: '16px',
            borderRadius: '10px',
            border: 'none',
            background: '#ffffff',
            color: '#000000',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          🎮 O‘YIN YARATISH
        </button>

        <button
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '16px',
            borderRadius: '10px',
            border: '1px solid #444',
            background: '#171717',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          🚪 XONAGA KIRISH
        </button>
      </div>
    </div>
  );
}

export default App;
