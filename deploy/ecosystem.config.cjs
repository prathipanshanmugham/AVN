// PM2 process file. Started by deploy/setup-vps.sh.
module.exports = {
  apps: [{
    name: 'avn',
    script: 'server/index.js',
    cwd: __dirname + '/..',
    instances: 1, // SQLite: keep a single process
    exec_mode: 'fork',
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production' },
    out_file: 'data/logs/out.log',
    error_file: 'data/logs/error.log',
    time: true,
  }],
};
