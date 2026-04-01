<?php
declare(strict_types=1);

/**
 * Generated from typia.manifest.json. Do not edit manually.
 */
return new class {
	private array $manifest = [
			'attributes' => [
				'variantKey' => [
					'typia' => [
						'constraints' => [
							'exclusiveMaximum' => null,
							'exclusiveMinimum' => null,
							'format' => null,
							'maxLength' => null,
							'maxItems' => null,
							'maximum' => null,
							'minLength' => null,
							'minItems' => null,
							'minimum' => null,
							'multipleOf' => null,
							'pattern' => null,
							'typeTag' => null
						],
						'defaultValue' => 'a',
						'hasDefault' => true
					],
					'ts' => [
						'items' => null,
						'kind' => 'string',
						'properties' => null,
						'required' => true,
						'union' => null
					],
					'wp' => [
						'defaultValue' => 'a',
						'enum' => [
							'a',
							'b',
							'c'
						],
						'hasDefault' => true,
						'type' => 'string'
					]
				],
				'variantLabel' => [
					'typia' => [
						'constraints' => [
							'exclusiveMaximum' => null,
							'exclusiveMinimum' => null,
							'format' => null,
							'maxLength' => 40,
							'maxItems' => null,
							'maximum' => null,
							'minLength' => 1,
							'minItems' => null,
							'minimum' => null,
							'multipleOf' => null,
							'pattern' => null,
							'typeTag' => null
						],
						'defaultValue' => 'Variant A',
						'hasDefault' => true
					],
					'ts' => [
						'items' => null,
						'kind' => 'string',
						'properties' => null,
						'required' => true,
						'union' => null
					],
					'wp' => [
						'defaultValue' => 'Variant A',
						'enum' => null,
						'hasDefault' => true,
						'type' => 'string'
					]
				]
			],
			'manifestVersion' => 2,
			'sourceType' => 'AbTestVariantAttributes'
		];

	public function apply_defaults(array $attributes): array
	{
		return $this->applyDefaultsForObject($attributes, $this->manifest['attributes'] ?? []);
	}

	public function validate(array $attributes): array
	{
		$normalized = $this->apply_defaults($attributes);
		$errors = [];

		foreach (($this->manifest['attributes'] ?? []) as $name => $attribute) {
			$this->validateAttribute(
				array_key_exists($name, $normalized),
				$normalized[$name] ?? null,
				$attribute,
				(string) $name,
				$errors,
			);
		}

		return [
			'errors' => $errors,
			'valid' => count($errors) === 0,
		];
	}

	public function is_valid(array $attributes): bool
	{
		return $this->validate($attributes)['valid'];
	}

	private function applyDefaultsForObject(array $attributes, array $schema): array
	{
		$result = $attributes;

		foreach ($schema as $name => $attribute) {
			if (!array_key_exists($name, $result)) {
				$derivedDefault = $this->deriveDefaultValue($attribute);
				if ($derivedDefault !== null) {
					$result[$name] = $derivedDefault;
				}
				continue;
			}

			$result[$name] = $this->applyDefaultsForNode($result[$name], $attribute);
		}

		return $result;
	}

	private function applyDefaultsForNode($value, array $attribute)
	{
		if ($value === null) {
			return null;
		}

		$kind = $attribute['ts']['kind'] ?? $attribute['wp']['type'] ?? null;
		if ($kind === 'union') {
			return $this->applyDefaultsForUnion($value, $attribute);
		}
		if ($kind === 'object' && is_array($value) && !$this->isListArray($value)) {
			return $this->applyDefaultsForObject($value, $attribute['ts']['properties'] ?? []);
		}
		if (
			$kind === 'array' &&
			is_array($value) &&
			$this->isListArray($value) &&
			isset($attribute['ts']['items']) &&
			is_array($attribute['ts']['items'])
		) {
			$result = [];
			foreach ($value as $index => $item) {
				$result[$index] = $this->applyDefaultsForNode($item, $attribute['ts']['items']);
			}
			return $result;
		}

		return $value;
	}

	private function deriveDefaultValue(array $attribute)
	{
		if ($this->hasDefault($attribute)) {
			return $attribute['typia']['defaultValue'];
		}

		$kind = $attribute['ts']['kind'] ?? $attribute['wp']['type'] ?? null;
		if ($kind !== 'object') {
			return null;
		}

		$properties = $attribute['ts']['properties'] ?? null;
		if (!is_array($properties)) {
			return null;
		}

		$derived = [];
		foreach ($properties as $name => $child) {
			if (!is_array($child)) {
				continue;
			}
			$childDefault = $this->deriveDefaultValue($child);
			if ($childDefault !== null) {
				$derived[$name] = $childDefault;
			}
		}

		return count($derived) > 0 ? $derived : null;
	}

	private function applyDefaultsForUnion($value, array $attribute)
	{
		if (!is_array($value) || $this->isListArray($value)) {
			return $value;
		}

		$union = $attribute['ts']['union'] ?? null;
		if (!is_array($union)) {
			return $value;
		}

		$discriminator = $union['discriminator'] ?? null;
		if (!is_string($discriminator) || !array_key_exists($discriminator, $value)) {
			return $value;
		}

		$branchKey = $value[$discriminator];
		if (!is_string($branchKey) || !isset($union['branches'][$branchKey]) || !is_array($union['branches'][$branchKey])) {
			return $value;
		}

		return $this->applyDefaultsForNode($value, $union['branches'][$branchKey]);
	}

	private function validateAttribute(bool $exists, $value, array $attribute, string $path, array &$errors): void
	{
		if (!$exists) {
			if (($attribute['ts']['required'] ?? false) && !$this->hasDefault($attribute)) {
				$errors[] = sprintf('%s is required', $path);
			}
			return;
		}

		$kind = $attribute['ts']['kind'] ?? $attribute['wp']['type'] ?? null;
		if (!is_string($kind) || $kind === '') {
			$errors[] = sprintf('%s has an invalid schema kind', $path);
			return;
		}
		if ($value === null) {
			$errors[] = sprintf('%s must be %s', $path, $this->expectedKindLabel($attribute));
			return;
		}

		if (($attribute['wp']['enum'] ?? null) !== null && !$this->valueInEnum($value, $attribute['wp']['enum'])) {
			$errors[] = sprintf('%s must be one of %s', $path, implode(', ', $attribute['wp']['enum']));
		}

		switch ($kind) {
			case 'string':
				if (!is_string($value)) {
					$errors[] = sprintf('%s must be string', $path);
					return;
				}
				$this->validateString($value, $attribute, $path, $errors);
				return;
			case 'number':
				if (!$this->isNumber($value)) {
					$errors[] = sprintf('%s must be number', $path);
					return;
				}
				$this->validateNumber($value, $attribute, $path, $errors);
				return;
			case 'boolean':
				if (!is_bool($value)) {
					$errors[] = sprintf('%s must be boolean', $path);
				}
				return;
			case 'array':
				if (!is_array($value) || !$this->isListArray($value)) {
					$errors[] = sprintf('%s must be array', $path);
					return;
				}
				$this->validateArray($value, $attribute, $path, $errors);
				if (isset($attribute['ts']['items']) && is_array($attribute['ts']['items'])) {
					foreach ($value as $index => $item) {
						$this->validateAttribute(true, $item, $attribute['ts']['items'], sprintf('%s[%s]', $path, (string) $index), $errors);
					}
				}
				return;
			case 'object':
				if (!is_array($value) || $this->isListArray($value)) {
					$errors[] = sprintf('%s must be object', $path);
					return;
				}
				foreach (($attribute['ts']['properties'] ?? []) as $name => $child) {
					$this->validateAttribute(
						array_key_exists($name, $value),
						$value[$name] ?? null,
						$child,
						sprintf('%s.%s', $path, (string) $name),
						$errors,
					);
				}
				return;
			case 'union':
				$this->validateUnion($value, $attribute, $path, $errors);
				return;
			default:
				$errors[] = sprintf('%s has unsupported schema kind %s', $path, $kind);
		}
	}

	private function validateUnion($value, array $attribute, string $path, array &$errors): void
	{
		if (!is_array($value) || $this->isListArray($value)) {
			$errors[] = sprintf('%s must be object', $path);
			return;
		}

		$union = $attribute['ts']['union'] ?? null;
		if (!is_array($union)) {
			$errors[] = sprintf('%s has invalid union schema metadata', $path);
			return;
		}

		$discriminator = $union['discriminator'] ?? null;
		if (!is_string($discriminator) || $discriminator === '') {
			$errors[] = sprintf('%s has invalid union discriminator metadata', $path);
			return;
		}
		if (!array_key_exists($discriminator, $value)) {
			$errors[] = sprintf('%s.%s is required', $path, $discriminator);
			return;
		}

		$branchKey = $value[$discriminator];
		if (!is_string($branchKey)) {
			$errors[] = sprintf('%s.%s must be string', $path, $discriminator);
			return;
		}
		if (!isset($union['branches'][$branchKey]) || !is_array($union['branches'][$branchKey])) {
			$errors[] = sprintf('%s.%s must be one of %s', $path, $discriminator, implode(', ', array_keys($union['branches'] ?? [])));
			return;
		}

		$this->validateAttribute(true, $value, $union['branches'][$branchKey], $path, $errors);
	}

	private function validateString(string $value, array $attribute, string $path, array &$errors): void
	{
		$constraints = $attribute['typia']['constraints'] ?? [];

		if (isset($constraints['minLength']) && is_int($constraints['minLength']) && strlen($value) < $constraints['minLength']) {
			$errors[] = sprintf('%s must be at least %d characters', $path, $constraints['minLength']);
		}
		if (isset($constraints['maxLength']) && is_int($constraints['maxLength']) && strlen($value) > $constraints['maxLength']) {
			$errors[] = sprintf('%s must be at most %d characters', $path, $constraints['maxLength']);
		}
		if (
			isset($constraints['pattern']) &&
			is_string($constraints['pattern']) &&
			$constraints['pattern'] !== '' &&
			!$this->matchesPattern($constraints['pattern'], $value)
		) {
			$errors[] = sprintf('%s does not match %s', $path, $constraints['pattern']);
		}
		if (
			isset($constraints['format']) &&
			is_string($constraints['format']) &&
			!$this->matchesFormat($constraints['format'], $value)
		) {
			$errors[] = sprintf('%s must match format %s', $path, $constraints['format']);
		}
	}

	private function validateArray(array $value, array $attribute, string $path, array &$errors): void
	{
		$constraints = $attribute['typia']['constraints'] ?? [];

		if (isset($constraints['minItems']) && is_int($constraints['minItems']) && count($value) < $constraints['minItems']) {
			$errors[] = sprintf('%s must have at least %d items', $path, $constraints['minItems']);
		}
		if (isset($constraints['maxItems']) && is_int($constraints['maxItems']) && count($value) > $constraints['maxItems']) {
			$errors[] = sprintf('%s must have at most %d items', $path, $constraints['maxItems']);
		}
	}

	private function validateNumber($value, array $attribute, string $path, array &$errors): void
	{
		$constraints = $attribute['typia']['constraints'] ?? [];

		if (isset($constraints['minimum']) && $this->isNumber($constraints['minimum']) && $value < $constraints['minimum']) {
			$errors[] = sprintf('%s must be >= %s', $path, (string) $constraints['minimum']);
		}
		if (isset($constraints['maximum']) && $this->isNumber($constraints['maximum']) && $value > $constraints['maximum']) {
			$errors[] = sprintf('%s must be <= %s', $path, (string) $constraints['maximum']);
		}
		if (
			isset($constraints['exclusiveMinimum']) &&
			$this->isNumber($constraints['exclusiveMinimum']) &&
			$value <= $constraints['exclusiveMinimum']
		) {
			$errors[] = sprintf('%s must be > %s', $path, (string) $constraints['exclusiveMinimum']);
		}
		if (
			isset($constraints['exclusiveMaximum']) &&
			$this->isNumber($constraints['exclusiveMaximum']) &&
			$value >= $constraints['exclusiveMaximum']
		) {
			$errors[] = sprintf('%s must be < %s', $path, (string) $constraints['exclusiveMaximum']);
		}
		if (
			isset($constraints['multipleOf']) &&
			$this->isNumber($constraints['multipleOf']) &&
			!$this->matchesMultipleOf($value, $constraints['multipleOf'])
		) {
			$errors[] = sprintf('%s must be a multiple of %s', $path, (string) $constraints['multipleOf']);
		}
		if (
			isset($constraints['typeTag']) &&
			is_string($constraints['typeTag']) &&
			!$this->matchesTypeTag($value, $constraints['typeTag'])
		) {
			$errors[] = sprintf('%s must be a %s', $path, $constraints['typeTag']);
		}
	}

	private function hasDefault(array $attribute): bool
	{
		return ($attribute['typia']['hasDefault'] ?? false) === true;
	}

	private function valueInEnum($value, array $enum): bool
	{
		foreach ($enum as $candidate) {
			if ($candidate === $value) {
				return true;
			}
		}
		return false;
	}

	private function matchesPattern(string $pattern, string $value): bool
	{
		$escapedPattern = str_replace('~', '\\~', $pattern);
		$result = @preg_match('~' . $escapedPattern . '~u', $value);
		return $result === 1;
	}

	private function matchesFormat(string $format, string $value): bool
	{
		switch ($format) {
			case 'uuid':
				return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1;
			case 'email':
				return filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
			case 'url':
			case 'uri':
				return filter_var($value, FILTER_VALIDATE_URL) !== false;
			case 'ipv4':
				return filter_var($value, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
			case 'ipv6':
				return filter_var($value, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false;
			case 'date-time':
				return preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $value) === 1;
			default:
				return true;
		}
	}

	private function matchesTypeTag($value, string $typeTag): bool
	{
		switch ($typeTag) {
			case 'uint32':
				return is_int($value) && $value >= 0 && $value <= 4294967295;
			case 'int32':
				return is_int($value) && $value >= -2147483648 && $value <= 2147483647;
			case 'uint64':
				return is_int($value) && $value >= 0;
			case 'float':
			case 'double':
				return is_int($value) || is_float($value);
			default:
				return true;
		}
	}

	private function matchesMultipleOf($value, $multipleOf): bool
	{
		if ($multipleOf == 0) {
			return true;
		}
		if (is_int($value) && is_int($multipleOf)) {
			return $value % $multipleOf === 0;
		}

		$remainder = fmod((float) $value, (float) $multipleOf);
		$epsilon = 0.000000001;
		return abs($remainder) < $epsilon || abs(abs((float) $multipleOf) - abs($remainder)) < $epsilon;
	}

	private function isNumber($value): bool
	{
		return is_int($value) || is_float($value);
	}

	private function isListArray(array $value): bool
	{
		$expectedKey = 0;
		foreach ($value as $key => $_item) {
			if ($key !== $expectedKey) {
				return false;
			}
			$expectedKey += 1;
		}
		return true;
	}

	private function expectedKindLabel(array $attribute): string
	{
		$kind = $attribute['ts']['kind'] ?? $attribute['wp']['type'] ?? 'value';
		return $kind === 'union' ? 'object' : (string) $kind;
	}
};
