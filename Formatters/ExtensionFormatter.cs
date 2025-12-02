namespace HeartPulse.Formatters;

public static class ExtensionFormatter
{
    public static string ToHumanTime(this DateTime dateTime)
    {
        return ToHumanTime((DateTimeOffset)dateTime);
    }

    public static string ToHumanTime(this DateTimeOffset dateTime)
    {
        var now = DateTimeOffset.Now;
        var diff = now - dateTime;

        if (diff.TotalSeconds < 10)
            return "щойно";

        if (diff.TotalSeconds < 60)
            return $"{(int)diff.TotalSeconds} {Pluralize((int)diff.TotalSeconds, "секунда", "секунди", "секунд")} тому";

        if (diff.TotalMinutes < 60)
            return $"{(int)diff.TotalMinutes} {Pluralize((int)diff.TotalMinutes, "хвилина", "хвилини", "хвилин")} тому";

        if (diff.TotalHours < 24)
            return $"{(int)diff.TotalHours} {Pluralize((int)diff.TotalHours, "година", "години", "годин")} тому";

        if (diff.TotalDays < 2)
            return "вчора" + $"[{dateTime.ToString("yy-MM-dd HH:mm:ss")}]";

        if (diff.TotalDays < 30)
            return $"{(int)diff.TotalDays} {Pluralize((int)diff.TotalDays, "день", "дні", "днів")} тому"
                + $"[{dateTime.ToString("yy-MM-dd HH:mm:ss")}]";

        if (diff.TotalDays < 365)
        {
            int months = (int)(diff.TotalDays / 30);
            return $"{months} {Pluralize(months, "місяць", "місяці", "місяців")} тому"
                   + $"[{dateTime.ToString("yy-MM-dd HH:mm:ss")}]";
        }

        int years = (int)(diff.TotalDays / 365);
        return $"{years} {Pluralize(years, "рік", "роки", "років")} тому"
               + $"[{dateTime.ToString("yy-MM-dd HH:mm:ss")}]";
    }
    
    private static string Pluralize(int value, string form1, string form2, string form5)
    {
        // Українські правила множини
        int n = Math.Abs(value);

        if (n % 10 == 1 && n % 100 != 1)
            return form1; // 1 секунда

        if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14))
            return form2; // 2 секунди

        return form5; // 5 секунд
    }
}