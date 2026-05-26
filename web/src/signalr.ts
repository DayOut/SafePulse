import * as signalR from "@microsoft/signalr";
import type { AppSettings, GroupMessageDto, GroupStatusRequestedDto, StatusChangedDto } from "./api";

export function createStatusConnection(
  settings: AppSettings,
  accessToken: string,
  onStatusChanged: (message: StatusChangedDto) => void,
  onGroupStatusRequested: (message: GroupStatusRequestedDto) => void,
  onChatMessage: (message: GroupMessageDto) => void,
  onStateChanged: (state: string) => void,
  onClosed: () => void,
) {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${settings.apiBaseUrl}/hubs/status`, {
      accessTokenFactory: () => accessToken,
    })
    .withAutomaticReconnect()
    .build();

  connection.on("statusChanged", onStatusChanged);
  connection.on("groupStatusRequested", onGroupStatusRequested);
  connection.on("chatMessage", onChatMessage);
  connection.on("messageReactionUpdated", onChatMessage);
  connection.onreconnecting(() => onStateChanged("Reconnecting"));
  connection.onreconnected(async () => {
    onStateChanged("Connected");
    await connection.invoke("JoinUserGroups");
  });
  connection.onclose(() => {
    onStateChanged("Disconnected");
    onClosed();
  });

  return connection;
}
