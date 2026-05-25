namespace HeartPulse.Localization;

public interface IAppLocalizer
{
    string NormalizeLanguage(string? language);
    string Text(string key, string? language, params object[] args);
}
