interface NavbarProps {
  onConnect: () => void;
  onDisconnect: () => void;
  publicKey: string | null;
  isConnected: boolean;
  connecting: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  currentView: 'home' | 'browse' | 'votes';
  onNavigate: (view: 'home' | 'browse' | 'votes') => void;
  relayerStatus?: string | null;
}


function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function Navbar({
  onConnect,
  onDisconnect,
  publicKey,
  isConnected,
  connecting,
  theme,
  onToggleTheme,
  currentView,
  onNavigate,
  relayerStatus,
}: NavbarProps) {
  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm" style={{ paddingLeft: 'calc(-100% + 100vw)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo/Brand */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => onNavigate('home')}
              className="text-left"
            >
              <h1 className="text-xl font-bold text-gray-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                DaoVote
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Anonymous DAO Voting
              </p>
            </button>

            {/* Navigation Links */}
            <div className="hidden md:flex items-center gap-4">
              <button
                onClick={() => onNavigate('browse')}
                className={`text-sm font-medium transition-colors ${
                  currentView === 'browse'
                    ? 'text-purple-600 dark:text-purple-400'
                    : 'text-gray-600 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400'
                }`}
              >
                Browse DAOs
              </button>
              <button
                onClick={() => onNavigate('votes')}
                className={`text-sm font-medium transition-colors ${
                  currentView === 'votes'
                    ? 'text-purple-600 dark:text-purple-400'
                    : 'text-gray-600 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400'
                }`}
              >
                Public Votes
              </button>
            </div>
          </div>

          {/* Right side controls */}
          <div className="flex items-center gap-4">
            {relayerStatus && (
              <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400">
                Relayer: {relayerStatus}
              </span>
            )}
            {/* Theme Toggle */}
            <button
              onClick={onToggleTheme}
              className="p-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
            </button>

            {/* Wallet Connection */}
            {isConnected && publicKey ? (
              <>
                <div className="hidden sm:block text-sm text-gray-700 dark:text-gray-300 font-mono bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-md">
                  {truncateAddress(publicKey)}
                </div>
                <button
                  onClick={onDisconnect}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={onConnect}
                disabled={connecting}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {connecting ? "Connecting..." : "Connect Wallet"}
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
