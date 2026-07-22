// Single source of truth for how Node launches the Python engines.
//
// Two things must be consistent across every spawn site:
//   1. The interpreter.  Hardcoding 'python' ignores PYTHON_EXECUTABLE and
//      breaks any deployment using a venv or `python3`.
//   2. The IO encoding.  Without PYTHONIOENCODING, CPython decodes stdin using
//      the locale codepage (cp1252 on Windows).  A single feature comment
//      containing 'Ø' or '≥' then raises UnicodeDecodeError from the stdin
//      iterator itself — outside any try block in the engine — which kills the
//      persistent worker and fails every in-flight request.
const pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python';

function pythonEnv(extra = {}) {
    return {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        // Unbuffered stdout so progress lines reach Node as they are printed
        // rather than sitting in a 8KB block buffer.
        PYTHONUNBUFFERED: '1',
        ...extra,
    };
}

// Spread into the options object of any child_process.spawn call.
function pythonSpawnOptions(options = {}) {
    return { ...options, env: pythonEnv(options.env) };
}

module.exports = { pythonExecutable, pythonEnv, pythonSpawnOptions };
