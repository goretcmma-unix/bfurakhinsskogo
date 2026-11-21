import { spawn } from 'node:child_process'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const isWin = process.platform === 'win32'
const cmd = isWin ? 'cmd.exe' : 'npx'
const args = isWin ? ['/d', '/s', '/c', 'npx electron-vite dev'] : ['electron-vite', 'dev']

let exitCode = 0

const child = spawn(cmd, args, {
  stdio: 'inherit',
  env,
  cwd: process.cwd(),
  windowsHide: false
})

child.on('error', (err) => {
  console.error(err)
  exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? exitCode)
})
