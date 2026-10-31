# 第三方许可与来源

本项目新增适配代码按 MIT 分发；独立第三方组件和模型保留原许可。包含非商用组件的合集只作非商用分享。不是对整包授予统一的Apache/MIT商业许可。

|组件|许可|来源|
|---|---|---|
|VoxCPM / VoxCPM2基础模型|Apache-2.0|https://github.com/OpenBMB/VoxCPM 和 https://huggingface.co/openbmb/VoxCPM2|
|Qwen3-TTS Base|Apache-2.0|https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base|
|Vevo2原版权重|CC BY-NC-ND 4.0|https://huggingface.co/RMSnow/Vevo2|
|Amphion源码|以 engines/Amphion/LICENSE 为准|https://github.com/open-mmlab/Amphion|
|Whisper代码与原版权重|MIT|https://github.com/openai/whisper|
|Node.js|Node及其所含第三方许可|runtime/node/LICENSE.txt|
|CPython|PSF及各附带第三方许可|runtime/python*/LICENSE*|
|Python库|各自许可|相应 *.dist-info 下的许可证和 licenses/python-components.json|
|LAME / lameenc|以源码归档与wheel内许可为准|licenses/corresponding-source，https://github.com/chrisstaite/lameenc|
|QQ桥|MIT|https://github.com/cheesehaqi/dsh-qq-onebot-bridge|
|NapCat Framework|Limited Redistribution License，非商用|https://github.com/NapNeko/NapCatQQ/blob/v4.18.41/LICENSE|

只在对应包中附带的组件适用该行。基础权重保持原始字节，不包含作者或用户专训权重。保留出处、版权与许可证；修改过的适配代码已说明。Vevo2的ND条款意味着不能把修改权重当作可自由再分发成果。QQ主客户端、DSH主程序不作为本包依赖二次打包。

LAME/lameenc的对应源码随包提供，便携Python中的编码库可以由使用者从源码重新构建替换。Node、Python及PyTorch分发包含其各自第三方许可，不能只保留本页删掉组件原许可证。
