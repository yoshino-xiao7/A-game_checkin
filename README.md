# A-game-checkin

面向 Yunzai v3、Miao-Yunzai 和 TRSS-Yunzai 的多游戏社区统一签到插件。

当前可运行版本按社区账号自动发现游戏角色：

- 米游社：原神、崩坏3、崩坏学园2、未定事件簿、崩坏：星穹铁道、绝区零
- 森空岛：明日方舟、明日方舟：终末地
- 库街区：战双帕弥什、鸣潮

项目按“社区适配器”扩展，后续社区不会把 Cookie、接口地址和错误码泄漏到 Yunzai 命令层。产品与架构约定见[设计方案](docs/design.md)和[领域词汇](CONTEXT.md)。

## 安装

把仓库克隆到 Yunzai 的 `plugins` 目录：

```bash
git clone https://github.com/yoshino-xiao7/A-game_checkin.git ./plugins/A-game_checkin
```

生成 32 字节主密钥：

```bash
node plugins/A-game_checkin/scripts/generate-key.js
```

将输出配置到运行 Yunzai 的环境变量 `A_GAME_CHECKIN_MASTER_KEY`，然后重启 Yunzai。未配置密钥时，插件会拒绝保存用户凭证，不会降级为明文。

## 命令

涉及凭证和账号详情的命令只能私聊使用。

```text
#签到帮助
#绑定签到 米游社
#绑定签到 米游社 Cookie
#绑定签到 森空岛
#绑定签到 森空岛 Token
#绑定签到 库街区
#签到账号
#签到目标
#签到日志
#签到日志 昨天
#签到日志 2026-07-31
#全部签到
#开启签到 <目标编号>
#关闭签到 <目标编号>
#删除签到账号 <账号编号>
```

签到日志实际展示的是按业务日期归档的游戏奖励流水，不带日期时默认查询今天。
每个游戏角色会列出本次签到获得的全部道具与数量；日志不会记录任何登录凭证。

`#绑定签到 米游社` 会生成二维码，使用米游社 App 扫码确认即可；Cookie
模式仅作为无法扫码时的备用入口。

`#绑定签到 森空岛` 会依次询问手机号和短信验证码，登录成功后只加密保存
换取到的 Token，不保存手机号和验证码；Token 模式为备用入口。

绑定时插件会在私聊中提示粘贴 Cookie，验证后自动发现游戏角色。新发现的目标默认开启自动签到，默认执行时间为每天 08:00（Asia/Shanghai）。

## 配置

默认配置位于 `config/default.json`。需要覆盖时新建不入库的 `config/config.json`，只填写要修改的字段，例如：

```json
{
  "scheduler": {
    "defaultHour": 9
  },
  "retry": {
    "maxAttempts": 2
  }
}
```

## 安全边界

- 凭证使用 AES-256-GCM 加密后保存。
- Cookie、Token、完整 UID 和原始接口响应不会写入业务日志。
- 验证码统一视为风控并停止自动重试，不实现验证码绕过。
- 删除账号会同时删除其凭证、签到目标和订阅。

## 开发

```bash
npm test
npm run check
```

社区适配器位于 `lib/communities`。每个适配器必须实现凭证验证、目标发现和签到，并返回统一结果类型。
