namespace HeartPulse.Options;

public class FakeGroupConfig
{
    public string GroupName { get; set; } = "";
    public int UserCount { get; set; } = 10;
}

public class FakeStatusSimulatorOptions
{
    public bool Enabled { get; set; }
    public string OwnerUserId { get; set; } = "admin-1";
    public int IntervalSeconds { get; set; } = 10;
    public int UsersChangedPerTick { get; set; } = 3;
    public List<FakeGroupConfig> Groups { get; set; } = [];
}
