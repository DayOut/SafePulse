using System.Collections.Concurrent;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Services;

public class WebPresenceTracker : IWebPresenceTracker
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _connectionsByUser = new();

    public void Connected(string userId, string connectionId)
    {
        var connections = _connectionsByUser.GetOrAdd(userId, _ => new ConcurrentDictionary<string, byte>());
        connections[connectionId] = 0;
    }

    public void Disconnected(string userId, string connectionId)
    {
        if (!_connectionsByUser.TryGetValue(userId, out var connections))
            return;

        connections.TryRemove(connectionId, out _);
        if (connections.IsEmpty)
            _connectionsByUser.TryRemove(userId, out _);
    }

    public bool IsOnline(string userId)
    {
        return _connectionsByUser.TryGetValue(userId, out var connections) && !connections.IsEmpty;
    }
}
