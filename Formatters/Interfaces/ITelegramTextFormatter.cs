using HeartPulse.Models;

namespace HeartPulse.Formatters.Interfaces;

public interface ITelegramTextFormatter
{
    string FormatStatus(UserStatus status, string? language = null);
    string FormatGroupLink(Group group);
    string BuildUserGroupsList(string userId, IReadOnlyList<Group> groups);
    string BuildCreateGroupResult(Group group);
    string BuildHelpText();
}
