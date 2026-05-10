#define VERSION "2.1"
const int knobCount = 4;
const uint8_t knobPins[knobCount] = {A0, A1, A2, A3};

int knobValues[knobCount] = {0};
bool knobActive[knobCount] = {false};
unsigned long lastSerialCheck = 0;
const unsigned long serialCheckInterval = 1000; // ms

int incrementStep = 2;  // Default increment step
String serialBuffer = "";  // Global buffer

void setup() {
  Serial.begin(9600);

  for (int i = 0; i < knobCount; i++) {
    bindToSoftware(knobPins[i], i + 1);
  }
}

void loop() {
  // Handle knobs
  for (int i = 0; i < knobCount; i++) {
    knobValues[i] = checkKnob(knobPins[i], knobValues[i], i);
  }

  handleSerialInput();
}

int checkKnob(uint8_t pin, int prevVal, int index) {
  int rawVal = readAverage(pin);
  int val = map(rawVal, 10, 1013, 0, 100);

  // Snap value to nearest increment step
  val = (val / incrementStep) * incrementStep;

  

  int delta = abs(val - prevVal);

  if (!knobActive[index]) {
    if (delta >= incrementStep) {
      knobActive[index] = true;
    }
  } else {
    if (delta >= incrementStep) {
      // Clamp for precision edge cases
      if (val > 98) val = 100;
      if (val < 2) val = 0;
      sendUpdate(val, index + 1);
      return val;
    } else {
      knobActive[index] = false;
    }
  }

  return prevVal;
}

void sendUpdate(int val, int ID) {
  Serial.print(val);
  Serial.print("@");
  Serial.print(ID);
  Serial.print("\n");
}

int readAverage(uint8_t pin) {
  long total = 0;
  for (int i = 0; i < 5; i++) {
    total += analogRead(pin);
  }
  return total / 5;
}

void bindToSoftware(uint8_t pin, int ID) {
  int initialValue = map(analogRead(pin), 0, 1024, 0, 100);
  initialValue = (initialValue / incrementStep) * incrementStep;
  if (initialValue > 100) initialValue = 100;

  Serial.print(initialValue);
  Serial.print("@");
  Serial.print(ID);
  Serial.print("\n");
}

// Example command: "STEP:5" to change incrementStep to 5

void handleSerialInput() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      serialBuffer.trim();
      processSerialCommand(serialBuffer);
      serialBuffer = "";  // Clear for next message
    } else {
      serialBuffer += c;
      if (serialBuffer.length() > 64) serialBuffer = ""; // Prevent overflow
    }
  }
}

void processSerialCommand(String input) {
  if (input.startsWith("STEP:")) {
    int newStep = input.substring(5).toInt();
    if (newStep >= 1 && newStep <= 100) {
      incrementStep = newStep;
      Serial.print("Step updated to ");
      Serial.println(incrementStep);
      
    } else {
      Serial.println("Invalid step. Must be 1–100.");
    }
  } else if (input.startsWith("V:")) {
    Serial.println( VERSION);
    
  } else if (input == "SYNC") {
    // Send current positions for all knobs to backend
    for (int i = 0; i < knobCount; i++) {
      sendUpdate(knobValues[i], i + 1);
    }
  }
}


