using HeartPulse.Formatters.Interfaces;
using HeartPulse.Models;

namespace HeartPulse.Formatters;

public class TelegramTextFormatter: ITelegramTextFormatter
{
    public string FormatStatus(UserStatus status)
    {
        switch (status)
        {
            case UserStatus.Safe:
                return "В безпеці";
            case UserStatus.InShelter:
                return "В укритті";
            case UserStatus.NeedHelp:
                return "Потребую допомоги";
            case UserStatus.Unknown:
                return "Невідомо";
        }
        throw new ArgumentOutOfRangeException(nameof(status));
    }

    public string BuildUserGroupsList(string userId, IReadOnlyList<Group> groups)
    {
        throw new NotImplementedException();
    }

    public string BuildCreateGroupResult(Group group)
    {
        throw new NotImplementedException();
    }

    public string BuildHelpText()
    {
        throw new NotImplementedException();
    }
}