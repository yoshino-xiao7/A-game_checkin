export async function notifyPrivateUser(user, message) {
  if (globalThis.Bot?.sendFriendMsg && user.botId) {
    return Bot.sendFriendMsg(user.botId, user.userId, message)
  }
  if (globalThis.Bot?.pickUser) {
    return Bot.pickUser(user.userId).sendMsg(message)
  }
  throw new Error("当前 Yunzai 适配器不支持主动私聊通知")
}
