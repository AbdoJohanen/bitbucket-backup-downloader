require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const winston = require('winston');
const { spawn } = require('child_process');

// Configuration from environment variables
const config = {
  user: process.env.BITBUCKET_USER,
  appPassword: process.env.BITBUCKET_APP_PASSWORD,
  workspace: process.env.BITBUCKET_WORKSPACE,
  backupDir: path.join(__dirname, 'downloads'),
  logsDir: path.join(__dirname, 'logs'),
  timestamp: new Date().toISOString().replace(/:/g,'-').split('.')[0],
  maxRetries: 3,
  retryBaseMs: 1000,           // 1s
  gitTimeoutMs: 5*60*1000      // 5m
};

// Basic auth for Bitbucket API
const authHeader = 'Basic '+ Buffer.from(`${config.user}:${config.appPassword}`).toString('base64');

// Initialize Winston logger
fs.ensureDirSync(config.backupDir);
fs.ensureDirSync(config.logsDir);

const errorLogFile = path.join(config.logsDir, `error-${config.timestamp}.log`);
const { combine, timestamp, printf, errors, colorize } = winston.format;

const logger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp({fmt:'YYYY-MM-DD HH:mm:ss'}),
    errors({stack:true}),
    printf(({timestamp,level,message,stack}) => 
      stack 
        ? `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}` 
        : `[${timestamp}] ${level.toUpperCase()}: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({fmt:'HH:mm:ss'}),
        printf(({timestamp,level,message}) => `[${timestamp}] ${level}: ${message}`)
      )
    }),
    new winston.transports.File({
      filename: errorLogFile,
      level: 'error',
      handleExceptions: true,
      handleRejections: true
    })
  ],
  exitOnError: false
});

// Helper: sleep
const delay = ms => new Promise(r => setTimeout(r,ms));

// Retry wrapper
async function withRetry(fn, desc) {
  let err;
  for(let i=1;i<=config.maxRetries;i++){
    try { return await fn(); }
    catch(e){
      err = e;
      logger.error(`${desc} failed (attempt ${i}/${config.maxRetries}): ${e.message}`);
      if(i<config.maxRetries){
        const wait = config.retryBaseMs*(2**(i-1));
        logger.info(`Retrying ${desc} in ${wait}ms`);
        await delay(wait);
      }
    }
  }
  throw err;
}

// Spinner for git commands with timeout
function gitCmd(args, cwd) {
  return new Promise((resolve,reject)=>{
    const p = spawn('git', args, { cwd, stdio: 'inherit' });
    const to = setTimeout(()=>{
      p.kill('SIGKILL');
      reject(new Error(`git ${args[0]} timed out`));
    }, config.gitTimeoutMs);
    p.once('error', e=>{ clearTimeout(to); reject(e); });
    p.once('close', code=> clearTimeout(to) || (code===0 ? resolve() : reject(new Error(`git ${args.join(' ')} exited ${code}`))));
  });
}

// Retry wrapper for git
const gitWithRetry = (args,cwd,desc)=> withRetry(()=> gitCmd(args,cwd), desc);

// Fetch all repos (pagelen=100)
async function getAllRepositories() {
  const repos = [];
  let url = `https://api.bitbucket.org/2.0/repositories/${config.workspace}?pagelen=100`;
  logger.info(`Fetching repositories from ${config.workspace}...`);
  while(url){
    const { data } = await withRetry(
      ()=> axios.get(url,{headers:{Authorization:authHeader}}),
      `HTTP GET ${url}`
    );
    repos.push(...data.values);
    url = data.next;
  }
  logger.info(`Found ${repos.length} repositories`);
  return repos;
}

// Backup a single repository
async function backupRepository({slug,name}) {
  const target = path.join(config.backupDir, `${slug}.git`);
  const authUrl = `https://${encodeURIComponent(config.user)}:` +
                  `${encodeURIComponent(config.appPassword)}` +
                  `@bitbucket.org/${config.workspace}/${slug}.git`;

  if(await fs.pathExists(target)){
    logger.info(`Updating: ${name} (${slug})`);
    await gitWithRetry(['remote','set-url','origin',authUrl], target, `${slug} set-url`);
    await gitWithRetry(['fetch','--all','--prune'], target, `${slug} fetch`);
    logger.info(`Successfully updated: ${slug}`);
  } else {
    logger.info(`Cloning: ${slug}`);
    await gitWithRetry(['clone','--mirror',authUrl,target], __dirname, `${slug} clone`);
    logger.info(`Successfully cloned: ${slug}`);
  }
}

// Main
(async()=>{
  const start=Date.now();
  logger.info('Bitbucket Backup Started');
  try {
    const repos = await getAllRepositories();
    await Promise.all(repos.map(r=>backupRepository(r).catch(e=>logger.error(`Backup failed for ${r.slug}: ${e.message}`))));
    const secs = ((Date.now()-start)/1000).toFixed(1);
    logger.info(`Backup completed in ${secs}s`);
    logger.on('finish',()=>process.exit(0));
    logger.end();
  } catch(err){
    logger.error(`Backup failed: ${err.message}`);
    logger.on('finish',()=>process.exit(1));
    logger.end();
  }
})();
