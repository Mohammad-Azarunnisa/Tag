module.exports = {
  apps: [
    {
      name: 'dmm-backend',
      cwd: __dirname + '/DMM_backend',
      script: 'src/server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
        PORT: 3002,
      },
    },
    {
      name: 'dmm-frontend',
      cwd: __dirname + '/DMM_frontend',
      script: 'node_modules/.bin/vite',
      args: '--port 3000 --host 0.0.0.0',
    },
    {
      name: 'dmm-admin',
      cwd: __dirname + '/DMM_Admin',
      script: 'node_modules/.bin/vite',
      args: '--port 3001 --host 0.0.0.0',
    },
  ],
};
