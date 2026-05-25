using HeartPulse.Formatters.Interfaces;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Options;
using Microsoft.Extensions.Options;

namespace HeartPulse.Formatters;

public class TelegramTextFormatter(IAppLocalizer localizer, IOptions<TelegramOptions> telegramOptions) : ITelegramTextFormatter
{
    public string FormatStatus(UserStatus status, string? language = null)
    {
        var key = status switch
        {
            UserStatus.Safe => "status.safe",
            UserStatus.InShelter => "status.inShelter",
            UserStatus.NeedHelp => "status.needHelp",
            UserStatus.Unknown => "status.unknown",
            _ => throw new ArgumentOutOfRangeException(nameof(status))
        };
        return localizer.Text(key, language);
    }

    public string FormatGroupLink(Group group)
    {
        var inviteLink = $"https://t.me/{telegramOptions.Value.BotUsername}?start=join_{group.Id}";
        var groupMess = "Твоє посилання на групу: ";
        groupMess += $"<a href=\"{inviteLink}\">{group.Name}</a>";
        return groupMess;
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
