# Lumina-Img v4 — Gallery-First 全功能现代双引擎图床

严格按照 **Monorepo (`apps/web` + `apps/api` + `deploy` + `extensions`)** 与 **Gallery-First** 设计规范打造的全功能 v4 图床工程，原生兼容 **ARM64 (aarch64)** 与 **x86_64** Linux 服务器，全端适配手机 / 平板 / 电脑。

## 核心功能一览 (v4 终极全功能版)

- **全能上传与前端处理**：拖拽 / 点击 / 全局 `Ctrl+V` 剪贴板粘贴 / 快捷键 `U` 上传 / URL 安全拉取（防 SSRF）；客户端压缩质量滑块、最大宽度缩放、WebP 转换、上传前裁剪/旋转/翻转编辑器；SHA-256 秒传与 >10MB 分片续传；上传后一键批量复制全部外链（URL / Markdown / HTML / BBCode）。
- **AI 智能与视觉检索**：OpenAI 兼容视觉接口（支持 GPT-4o-mini、Gemini、Qwen-VL、Ollama 本地模型，未配置 Key 时自动启用本地色系与构图打标），一键生成画面描述与标签、相似图片检索，画廊搜索支持语义模糊查找。
- **双引擎存储、多策略组与 WebDAV**：Local NVMe + Cloudflare R2 智能路由与无损热迁移；管理后台支持多厂商 S3 策略组（R2 / 阿里云 OSS / 腾讯云 COS / MinIO / B2）与连通性测试；内置 `/webdav/` 网盘挂载接口（支持 Finder / RaiDrive / Infuse / Alist）。
- **动态处理、水印与隐私风控**：集成 `imgproxy` HMAC 签名（缩略图 / WebP / AVIF / 真实用户默认水印 / 灯箱自定义尺寸与模糊生成器）；支持公开 / 仅凭链接 / 私密 / 密码保护 / 阅后即焚；私密图支持限时签名直链；支持 Referer 白黑名单、空 Referer 拦截、IP 黑名单与审核队列。
- **全端体验与生态集成**：电脑端左侧导航+实时配额、平板端窄图标栏、手机端底部原生 Tab + PWA 安装；内置 Chrome/Edge 右键转存扩展 (`extensions/chrome-extension`)；一键导出 ShareX `.sxcu`、PicGo / PicList / Lsky Pro v2 兼容接口、随机图 API (`/api/v1/random`)；SMTP 邮件发信与找回密码、2FA 二维码绑定、个人与全站 14 天趋势统计仪表盘、创作者公开主页 (`/u/[username]`)。

## 一键安装与升级

```bash
git clone https://github.com/vmenzo/Lumina.git && cd Lumina && bash install.sh
```

安装脚本会一步步带你走完（共 5 步）：

1. 检查运行环境：没有 Docker 会问你要不要自动装，需要 Docker Compose v2。
2. 选部署模式：`1` 域名模式（HTTPS，Caddy 自动申请证书）或 `2` IP 模式（HTTP `:80`）。
3. 填管理员账号（用户名、邮箱、密码）和存储：外部 S3 / R2 可选，不填就只用本机存储。
4. 生成 `.env` 配置文件：已有 `.env` 会先备份，数据库、JWT、imgproxy 等密钥会沿用原来的，不会丢。
5. 构建并启动容器：启动后会等 `/api/health` 就绪（最多等 60 秒）。

装完会打印访问地址、管理员账号和密码，以及常用命令（`make logs` 看日志、`make down` 停服务、`make backup-db` 备份数据库）。

> 已有旧版本环境升级时，保留原 `.env` 与数据卷，直接执行 `make up`（域名 HTTPS 模式）或 `make up-local`（无域名 IP 模式）即可平滑升级，数据库会自动补齐新增表结构与索引。
