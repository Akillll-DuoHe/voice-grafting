# 连接自己的角色QQ

本包附未修改的 NapNeko/NapCatQQ v4.18.41 Framework 归档。它使用安装者自己已安装的腾讯QQ客户端，不包含任何已登录客户端、QQNT.dll、聊天数据库或作者账号。

1. 在自己选定的新目录解压 third-party/NapCat.Framework-v4.18.41.zip。保留原版文件，阅读同目录许可证。
2. QQ客户端由本人从官方安装，先确认自己准备的角色号可在手机使用。不要让同一角色号同时被两套协议端争抢登录。
3. 运行原版归档中的 napiLoader.bat，它按官方启动器读取本机QQ安装路径并启动。若提示找不到QQ路径，按NapCat官方Framework文档处理；本包不自动改动或结束你已有QQ进程。这个步骤需要本机交互登录，不能离线替你注册或绕过验证。
4. 在NapCat本机WebUI登录角色号，核对头像和QQ号。二维码过期就在自己的WebUI刷新，不要重复扫描旧截图。
5. 在OneBot配置里添加反向WebSocket客户端，导入本包setup生成的 napcat-onebot.local.json，或填写其中的 url、token、messagePostFormat=array。默认ws://127.0.0.1:28136。令牌由你本机生成，不要公开截图或上传配置。
6. DSH使用同一个profile安装QQ桥，等待反向WS连接。用白名单本人号发消息测试。文字通后再测试转写、声音、记忆和自己的歌单。

官方来源：https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.41 。安装说明：https://doc.napneko.icu/guide/boot/release 。上游版本会影响QQ兼容性，本包没有承诺所有未来QQ版本都兼容；失败时保留日志，先核对本机版本和错误，不要重启或卸载无关模型。
