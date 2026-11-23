# Lumina-Img v4 — Gallery-First 全功能现代双引擎图床

Lumina-Img 是一款自托管图床，支持本地存储与 Cloudflare R2 双引擎，兼容 ARM64 与 x86_64 架构的 Linux 服务器，覆盖桌面、平板与移动端。

## 一键安装

```bash
git clone https://github.com/vmenzo/Lumina.git && cd Lumina && bash install.sh
```

安装脚本共 5 步：

1. 检查环境：确认 Docker 与 Compose 已安装，未安装时提示自动安装
2. 选择部署模式：域名 HTTPS 或 IP 直连
3. 配置管理员账号与存储：设置管理员账号密码，R2 存储为可选项
4. 生成配置文件：写入 `.env`，已有配置会先备份，密钥予以保留
5. 构建并启动服务：等待健康检查通过后，输出访问地址与管理员账号密码

## 核心功能

- **上传**：支持拖拽、粘贴、快捷键与链接拉取；支持上传前压缩、裁剪、旋转与 WebP 转换；大文件支持分片上传与断点续传，相同文件基于 SHA-256 秒传去重；支持批量复制 URL、Markdown、HTML、BBCode 格式外链
- **AI 能力**：兼容 OpenAI 视觉模型（GPT-4o-mini、Gemini、Qwen-VL、Ollama），自动生成图片描述与标签，支持以图搜图与语义检索
- **存储**：本地存储与 Cloudflare R2 双引擎，支持智能路由与一键无损热迁移；支持多厂商 S3 策略组与 WebDAV 挂载
- **图片处理**：基于 imgproxy 实现缩略图生成、WebP / AVIF 格式转换、水印与灯箱预览，全部请求经 HMAC 签名校验
- **访问控制**：支持公开、仅链接、私密、密码保护与阅后即焚；支持限时签名直链、Referer / IP 黑白名单与内容审核
- **全端体验**：桌面端左侧导航与实时配额、平板端窄图标栏、移动端底部 Tab，支持安装为 PWA
- **生态集成**：支持 Chrome / Edge 右键转存、ShareX、PicGo / PicList、Lsky Pro v2 协议与随机图 API
- **管理与安全**：支持 SMTP 邮件通知、双重验证、统计仪表盘与创作者主页

## 部署模式

- **域名模式**：配置域名后自动签发 HTTPS 证书，通过域名访问
- **IP 模式**：直接使用服务器 IP 通过 HTTP 访问，无需域名与证书

> 旧版本升级：保留原 `.env` 与数据卷，执行 `make up`（域名模式）或 `make up-local`（IP 模式）即可平滑升级。
