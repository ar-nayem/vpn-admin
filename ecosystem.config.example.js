module.exports = {
  apps: [
    {
      name: 'vpn-admin',
      script: 'server.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production', PORT: 7500 },
    },
    {
      name: 'vpn-storefront',
      script: 'storefront/server.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production', STOREFRONT_PORT: 7600 },
    },
  ],
};
