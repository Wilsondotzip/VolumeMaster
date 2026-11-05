"""Opening the device's serial (COM) port."""
import serial


def connect_serial(config):
    """Try once to open the serial port. Returns a Serial object or None."""
    port = config.get('comport', '')
    if not port or port == 'COM':
        print('ERROR:COM_PORT:No COM port selected. Please select a port in Settings.', flush=True)
        return None
    try:
        ser = serial.Serial(port)
        ser.baudrate = config['baudrate']
        ser.bytesize = config['bytesize']
        ser.parity = config['parity']
        ser.stopbits = config['stopbits']
        return ser
    except serial.SerialException as e:
        cause = e.__cause__ or e.__context__
        msg = str(e)
        if isinstance(cause, PermissionError) or ('Access is denied' in msg or 'PermissionError' in msg):
            print(f'ERROR:COM_PORT:{port} is in use by another program. Close any serial monitors (Arduino IDE, PuTTY, etc.) and it will reconnect automatically.', flush=True)

        elif isinstance(cause, FileNotFoundError) or ('filenotfounderror' in msg.lower() or 'cannot find the file' in msg.lower()):

            print(f'ERROR:COM_PORT:{port} not found. Check the correct port is selected in Settings.', flush=True)
        else:
            print(f'ERROR:COM_PORT:Cannot open {port} — {e}', flush=True)
        return None
