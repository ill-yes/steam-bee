export function collectComposeInterpolationVariables(contents) {
  const variables = new Set();
  for (const content of contents) {
    for (const match of content.matchAll(
      /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    )) {
      variables.add(match[1] ?? match[2]);
    }
  }
  return variables;
}

export function isolateComposeEnvironment(environment, variables) {
  const isolated = {};
  for (const [name, value] of Object.entries(environment)) {
    if (
      value === undefined ||
      name.startsWith("COMPOSE_") ||
      variables.has(name)
    ) {
      continue;
    }
    isolated[name] = value;
  }

  isolated.COMPOSE_DISABLE_ENV_FILE = "true";
  return isolated;
}
