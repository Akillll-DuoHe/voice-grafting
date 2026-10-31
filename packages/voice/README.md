# DSH 通用本地声音层 · 离线版 0.3.0

适用于已有 QQ、B站或其它渠道桥的 DSH 用户。提供本地语音转写、文字转声音、本地试听、参考声音注册、VoxCPM2 LoRA 训练准备、Qwen3-TTS 备选克隆、Vevo2 歌声转换，以及可选的本地记忆接口。不会替换你的渠道账号或人设。

包内已附 Windows x64 Node、Python 3.11/3.12、相互隔离的 Python 库、VoxCPM2 / Qwen3-TTS Base / Vevo2 原版权重、Whisper small/medium；安装脚本不执行 pip/npm 联网下载。先完整解压到你准备长期保留的目录。

宿主前提：Windows 10/11 x64、已安装兼容的 DeepSeek Harness，以及适配 CUDA 的 NVIDIA 驱动。DSH 和显卡驱动不是本包提供的软件。默认说话使用 VoxCPM2，需要足够显存；在新电脑上须运行环境检查并实际试听。其它系统与所有显卡尚未验证。

## 安装

1. 准备你自己的干净单人 WAV 参考音，建议 5—15 秒，照 docs/素材与训练.md 检查。
2. 双击 `安装配置.cmd`，依次填自己的参考音、DSH CLI 路径。默认使用 desktop profile；使用其它 profile 时通过命令加 `--profile`。
3. DSH 插件启用后自动启动本包后端，模型按需加载。令牌在安装者自己的 user-data 目录生成；不会出现在终端输出。
4. 双击 `环境检查.cmd`，再按下方命令试听。检查导入成功不代表模型推理或听感已经通过。

命令行等价操作（在本包根目录运行）：
```powershell
.\runtime\node\node.exe .\tools\cli.mjs setup --reference "你的参考音.wav" --data "你的数据目录"
.\runtime\node\node.exe .\tools\cli.mjs install --dsh "你的dsh.cmd" --profile desktop --data "你的数据目录"
.\runtime\node\node.exe .\tools\cli.mjs say --data "你的数据目录" --text "你好，这是我的本地声音。" --out "你的试听.wav" --open
```

只在本地独立试听、暂不启动 DSH 时，可运行 `启动本地试听服务.cmd`。同一个数据目录只运行一套服务；插件能识别自己的已启动协议服务，不会关闭其它进程。安装后移动整包目录会使配置里的本地路径变化，应先停自己的服务，再按新位置重新配置，保留原数据备份。

## 接现有桥

见 docs/适配现有DSH插件.md。HTTP 使用 OpenAI 兼容 `/v1/audio/speech` 和 `/v1/audio/transcriptions`，DSH 插件还提供 `ctx.localVoice`。填写安装者自己的端口和本地令牌；不需要本包作者账号。QQ、B站的媒体收发仍由已有桥负责。

## 记忆和点歌

本包导出 `@local/dsh-local-voice/memory` 与 `/songs`，供已有桥按说明挂接。它们不会自动替换第三方桥的会话管理。配套的独立 QQ 桥已经接好记忆预算、自然模式切换、歌单和换歌。包里没有歌曲、参考声音、人设、聊天或训练成品，使用者必须导入自己的素材。

## 许可与交付边界

请读 LICENSES.md。Vevo2 原版权重为 CC BY-NC-ND 4.0，不能把包含它的整包宣传为可任意商用或任意分发修改权重。VoxCPM2、Qwen、Whisper 分别保留各自许可。首次使用须用自己的声音实测；异机 GPU 推理、训练收敛和听感尚待安装者确认。完整技术核对见 VALIDATION.json。
