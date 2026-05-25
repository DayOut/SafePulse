using HeartPulse.Models;

namespace HeartPulse.Events;

public sealed record UserStatusChangedEvent(
    AppUser User,
    UserStatusChangeSource Source,
    DateTime ChangedAt);
