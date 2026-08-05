"""Value helpers shared by the Excel report generators.

These are the functions the alignment comparison export and the corrosion
assessment report both need to read one alignment row the same way. They are
stateless by design: the style objects each generator uses stay module-level
singletons in the generator itself, because the comparison report is 40 columns
wide and a 100k-row export is four million cells — a shared factory handing out
fresh Font/Fill/Border objects per call is what made that export a
multi-gigabyte job in the first place.

Each function here carries the behaviour the alignment export arrived at through
production defects, not a simplified version of it. The clock reader
understands unconverted Excel time serials, the clock comparison wraps around
the dial before deciding whether anything changed, and the cell sanitiser
serialises structured values before checking them for formula injection. A
second report that quietly reimplemented any of those would report different
numbers from the first for the same row, which is the whole reason they are
here rather than duplicated.
"""

import json

# Two clock readings within this many degrees count as unchanged. One clock
# minute is 0.5 degrees, so this tolerates vendor rounding of about +/- 2 min.
CLOCK_UNCHANGED_TOLERANCE_DEG = 1.0


def first_value(row, *keys):
    """The first populated value among `keys`, treating "" and "-" as absent."""
    for key in keys:
        value = row.get(key)
        if value not in (None, "", "-"):
            return value
    return None


def as_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_cell_value(value):
    """Prevent spreadsheet applications from evaluating untrusted text as a formula."""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def difference(left, right):
    left_number = as_number(left)
    right_number = as_number(right)
    if left_number is None or right_number is None:
        return None
    return left_number - right_number


def clock_degrees(value):
    """A clock position as degrees on the 12-hour pipeline dial, or None."""
    if value in (None, "", "-", "N/A"):
        return None
    try:
        if isinstance(value, (int, float)):
            numeric = float(value)
            if 0 < numeric < 1:
                # An unconverted Excel time serial (fraction of a 24 h day):
                # 0.5 means 12:00, not half past midnight. Convert to hours,
                # then onto the dial at 30 degrees per hour so it agrees with
                # the hour-based conversions below (12:00 -> 0/360 degrees).
                return ((numeric * 24.0) % 12.0) * 30.0
            return numeric * 30
        text = str(value)
        hour, minute = text.split(":", 1)
        return (int(hour) % 12) * 30 + int(minute[:2]) * 0.5
    except (TypeError, ValueError):
        return None


def clock_difference(new_clock, old_clock):
    """(changed?, magnitude in degrees) for two clock readings, the short way round."""
    new_degrees = clock_degrees(new_clock)
    old_degrees = clock_degrees(old_clock)
    if new_degrees is None or old_degrees is None:
        return None, None
    delta = abs(new_degrees - old_degrees)
    wrapped_delta = min(delta, 360 - delta)
    # The verdict must agree with the reported (wrapped) magnitude:
    # 11:59 vs 12:01 is a 1 degree change, not a 359 degree "YES".
    changed = "no" if wrapped_delta <= CLOCK_UNCHANGED_TOLERANCE_DEG else "YES"
    return changed, wrapped_delta
