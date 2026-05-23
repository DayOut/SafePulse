namespace HeartPulse.Services.Interfaces;

public interface IWebPresenceTracker
{
    void Connected(string userId, string connectionId);
    void Disconnected(string userId, string connectionId);
    bool IsOnline(string userId);
}
