# 远程访问与换电脑启动方案

这套方案的目标是：**电脑上运行 Antigravity + 本项目代理，手机或另一台电脑通过浏览器访问同一个会话**。  
不在同一个局域网时走 ngrok 公网隧道；在同一 Wi-Fi 下也可以走局域网模式。

## 一、首次在一台 Windows 电脑上启动

### 1. 准备环境

- 安装 Node.js 18 或更新版本。
- 安装 Antigravity。
- 拉取本项目，并进入项目目录：

```powershell
git clone <your-repo-url> antigra
cd antigra
```

### 2. 配置本机私密参数

复制配置模板：

```powershell
copy .env.example .env.local
```

编辑 `.env.local`：

```env
NGROK_AUTHTOKEN=你的 ngrok authtoken
ALLOWED_EMAIL=你的 Google 邮箱
NGROK_DOMAIN=
PORT=5555
CDP_PORT=9223
ANTIGRAVITY_PROJECT_DIR=
ANTIGRAVITY_BINARY=
```

说明：

- `NGROK_AUTHTOKEN`：ngrok 后台的 authtoken，用来创建公网隧道。
- `ALLOWED_EMAIL`：允许登录访问代理的 Google 邮箱。
- `NGROK_DOMAIN`：可选。如果你在 ngrok 里预留了固定域名，填这里后每次 URL 都稳定。
- `ANTIGRAVITY_PROJECT_DIR`：可选。留空时默认打开当前仓库；也可以填你要让 Antigravity 打开的项目路径。
- `ANTIGRAVITY_BINARY`：可选。自动识别失败时，填 `Antigravity.exe` 的完整路径。

`.env.local` 已被 `.gitignore` 忽略，不要提交 token。

### 3. 一键启动公网远程模式

双击或在 PowerShell 里运行：

```powershell
.\start-remote.cmd
```

脚本会做这些事：

1. 检查 Node.js。
2. 首次没有 `node_modules` 时自动执行 `npm install`。
3. 尝试用 `--remote-debugging-port=9223` 启动 Antigravity。
4. 启动本项目代理。
5. 创建 ngrok 公网 URL，并在终端输出 URL / QR。

手机不在同一个局域网时，直接打开终端打印的 `https://*.ngrok-free.app` URL，然后用 `ALLOWED_EMAIL` 对应的 Google 账号登录。

也可以不编辑 `.env.local`，直接把关键参数传给脚本：

```powershell
.\start-remote.cmd -AllowedEmail you@gmail.com -NgrokAuthtoken <你的-ngrok-token>
```

如果有固定域名：

```powershell
.\start-remote.cmd -AllowedEmail you@gmail.com -NgrokAuthtoken <token> -NgrokDomain your-name.ngrok-free.app
```

## 二、同一 Wi-Fi / 局域网模式

不需要 ngrok 时运行：

```powershell
.\start-local.cmd
```

或：

```powershell
.\start-remote.cmd -NoTunnel
```

它会绑定到 `0.0.0.0`，终端会打印类似：

```text
http://192.168.1.23:5555
```

手机连接同一个 Wi-Fi 后打开这个地址即可。  
如果 Windows 防火墙弹窗，允许 Node.js 在“专用网络”访问。

## 三、换电脑后怎么启动

每台电脑只需要保留自己的本地配置：

1. 新电脑安装 Node.js 18+ 和 Antigravity。
2. `git clone` 拉取项目。
3. 复制 `.env.example` 为 `.env.local`。
4. 填入同一个 `NGROK_AUTHTOKEN`、`ALLOWED_EMAIL`，以及可选的 `NGROK_DOMAIN`。
5. 运行：

```powershell
.\start-remote.cmd
```

注意：

- token 不进 Git，每台电脑本地放一份 `.env.local`。
- 如果要稳定 URL，请在 ngrok 后台预留域名并写入 `NGROK_DOMAIN`。
- 同一个固定 ngrok 域名同一时间通常只能被一台电脑占用；切换电脑前先停掉旧电脑脚本。

## 四、常用参数

```powershell
# 只打印将执行的动作，不真正启动
.\start-remote.cmd -DryRun -NoInstall -SkipAntigravity -AllowedEmail you@gmail.com -NgrokAuthtoken <token>

# 跳过自动启动 Antigravity，只启动代理
.\start-remote.cmd -SkipAntigravity

# Antigravity 已运行但 CDP 不通时，允许脚本重启它
.\start-remote.cmd -RestartAntigravity

# 改端口
.\start-remote.cmd -Port 8080 -CdpPort 9224

# 指定要打开的项目
.\start-remote.cmd -ProjectDir D:\work\my-project
```

## 五、常见故障

### 1. 页面打开了，但连不上 Antigravity

- 确认 Antigravity 是用 `--remote-debugging-port=9223` 启动的。
- 访问 `http://127.0.0.1:9223/json/version`，能返回 JSON 才说明 CDP 可用。
- 如果 Antigravity 已经提前打开，但 CDP 不通，关闭它后重新运行 `.\start-remote.cmd`，或使用 `-RestartAntigravity`。

### 2. 手机打不开局域网地址

- 手机和电脑必须在同一 Wi-Fi。
- Windows 防火墙需要允许 Node.js 的专用网络访问。
- 确认终端打印的是 `192.168.x.x` 或类似局域网 IP，而不是 `127.0.0.1`。

### 3. ngrok token 或固定域名失败

- 重新确认 `.env.local` 里的 `NGROK_AUTHTOKEN`。
- 固定域名必须是当前 ngrok 账号下可用的 reserved domain。
- 如果同一个 `NGROK_DOMAIN` 正被另一台电脑占用，先停掉旧电脑上的代理。

### 4. 端口被占用

改用其他端口：

```powershell
.\start-remote.cmd -Port 8080
```

如 CDP 端口被占用：

```powershell
.\start-remote.cmd -CdpPort 9224
```

