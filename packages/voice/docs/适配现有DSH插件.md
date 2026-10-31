# 把声音接到已有渠道

给你自己的 DSH 这段指引：请读取本包 README 和接口代码，保留我的现有 QQ/B站桥及账号。先运行本地声音环境检查，用我提供的 WAV 配置和试听。读取我自己的 voice.local.json，按现有桥的接口接入转写和合成；不要把本地令牌发给远端。不要给我附加作者人设、称呼、回复长度或歌曲。请列明你修改了哪个适配点，并用我自己的账号测试收发。

HTTP 基址默认 `http://127.0.0.1:28133/v1`，Authorization 为安装者 voice.local.json 中的 token。GET `/health` 在端口根路径。识别 POST `/v1/audio/transcriptions`，multipart 的 file 是音频，model=local-asr。合成 POST `/v1/audio/speech`，JSON 为 `{ "model":"local-tts", "input":"要说的话", "voice":"default", "response_format":"mp3" }`，也可选 wav。

插件服务 `ctx.get('localVoice')` 的具体签名见 plugin/src/client.mjs。入站音频→transcribe→交给你现有模型→取得最终答复→根据你自己的文字/语音模式选择直接发送或 synthesize→把音频交给你自己的渠道发送 API。一次最终答复只选择一个出口。B站是否支持原生语音条取决于你的桥；不支持时可用其已有音频附件方式，本包不自动评论或投稿。

本地服务只监听回环地址。maxSpeechChars 默认600字；长回复请由桥按语义分段。语言和语音模式应由桥持久化。需要部署到另一台主机时，必须由使用者另行配置安全传输，本包没有默认公网入口。

记忆适配见《本地记忆.md》。声音 HTTP 兼容不代表所有第三方会话钩子已实测；请先看你自己桥的源码和当前 DSH API，按对应钩子接入。
