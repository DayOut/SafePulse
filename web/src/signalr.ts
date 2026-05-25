import * as signalR from "@microsoft/signalr";
import type { AppSettings, GroupStatusRequestedDto, StatusChangedDto } from "./api";

export function createStatusConnection(
  settings: AppSettings,
  accessToken: string,
  onStatusChanged: (message: StatusChangedDto) => void,
  onGroupStatusRequested: (message: GroupStatusRequestedDto) => void,
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
