module.exports = {
  apps: [
    {
      name: 'dmm-frontend',
      cwd: __dirname + '/DMM_frontend',
      script: 'node_modules/vite/bin/vite.js',
      interpreter: 'node',
      args: '--port 3000 --host 0.0.0.0',
    },
    {
      name: 'dmm-admin',
      cwd: __dirname + '/DMM_Admin',
      script: 'node_modules/vite/bin/vite.js',
      interpreter: 'node',
      args: '--port 3001 --host 0.0.0.0',
    },
  ],
};
