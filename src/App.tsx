import { useEffect, useState } from 'react';
import './index.css';

function App() {
  const [pong, setPong] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const testConnection = async () => {
      try {
        if (window.augos && typeof window.augos.ping === 'function') {
          const response = await window.augos.ping();
          setPong(response);
          setIsConnected(true);
        } else {
          console.error('AugOS API not available');
        }
      } catch (error) {
        console.error('Failed to ping main process:', error);
      }
    };

    testConnection();
  }, []);

  return (
    <div className="min-h-screen bg-cyber-black text-cyber-blue p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12">
          <h1 className="text-4xl font-bold text-cyber-green mb-2">AugOS</h1>
          <p className="text-gray-400">Universal Remote for your Computer</p>
        </header>

        <main className="space-y-8">
          <section className="cyber-border p-6 bg-cyber-gray">
            <h2 className="text-2xl font-semibold text-cyber-green mb-4">System Status</h2>
            <div className="space-y-2">
              <p className="flex items-center">
                <span className="mr-2">IPC Connection:</span>
                <span className={isConnected ? 'text-cyber-green' : 'text-red-500'}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </p>
              {pong && (
                <p className="text-sm text-gray-400">
                  Ping Response: {pong}
                </p>
              )}
            </div>
          </section>

          <section className="cyber-border p-6 bg-cyber-gray">
            <h2 className="text-2xl font-semibold text-cyber-green mb-4">Chat Interface</h2>
            <div className="space-y-4">
              <div className="h-64 bg-black border border-cyber-blue rounded-sm p-4">
                <p className="text-gray-500 text-center mt-24">
                  Chat interface will be implemented here
                </p>
              </div>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="Ask AugOS to do something..."
                  className="flex-1 px-4 py-2 bg-black border border-cyber-blue text-cyber-blue rounded-sm focus:outline-none focus:border-cyber-green"
                />
                <button className="cyber-button">
                  Send
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
