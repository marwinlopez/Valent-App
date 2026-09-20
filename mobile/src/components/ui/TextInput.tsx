import { TextInput as PaperTextInput, HelperText } from 'react-native-paper';
import { View } from 'react-native';
import type { ComponentProps } from 'react';

export interface TextInputProps extends ComponentProps<typeof PaperTextInput> {
  errorText?: string;
}

export function TextInput({ errorText, ...props }: TextInputProps) {
  return (
    <View>
      <PaperTextInput mode="outlined" error={Boolean(errorText)} {...props} />
      {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
    </View>
  );
}
