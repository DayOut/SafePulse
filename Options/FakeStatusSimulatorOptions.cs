namespace HeartPulse.Options;

public class FakeStatusSimulatorOptions
{
    public bool Enabled { get; set; }
    public string GroupName { get; set; } = "fear group";
    public string OwnerUserId { get; set; } = "admin-1";
    public int UserCount { get; set; } = 130;
    public int IntervalSeconds { get; set; } = 10;
    public int UsersChangedPerTick { get; set; } = 12;
}
